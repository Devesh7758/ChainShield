#![no_std]
use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, token, Address, BytesN, Env, String, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error { NotInit=1, AlreadyInit=2, NotFound=3, BadParams=4, MilestoneDone=5, NotPending=6, WindowOpen=7, WindowClosed=8 }

#[contracttype] #[derive(Clone)]
pub enum Key { Config, NextGrant, NextClaim, Grant(u32), Claim(u32), DocSeen(BytesN<32>), Stats }
#[contracttype] #[derive(Clone)]
pub struct Config { pub attestor: Address, pub risk_threshold: u32, pub challenge_secs: u64 }
#[contracttype] #[derive(Clone, Copy, Debug, PartialEq)]
pub enum ClaimStatus { Pending=0, Settled=1, Frozen=2, Duplicate=3 }
#[contracttype] #[derive(Clone)]
pub struct Grant { pub id:u32, pub name:String, pub funder:Address, pub ngo:Address, pub token:Address, pub milestones:Vec<i128>, pub released:Vec<bool>, pub escrowed:i128 }
#[contracttype] #[derive(Clone)]
pub struct Claim { pub id:u32, pub grant_id:u32, pub milestone:u32, pub doc_hash:BytesN<32>, pub amount:i128, pub risk:u32, pub status:ClaimStatus, pub settle_after:u64 }
#[contracttype] #[derive(Clone)]
pub struct Stats { pub grants:u32, pub escrowed:i128, pub released:i128, pub claims:u32, pub auto_released:u32, pub flagged:u32, pub duplicates_blocked:u32, pub frozen:u32 }
#[contractevent] pub struct DuplicateBlocked { #[topic] pub claim_id:u32, pub first_claim_id:u32 }
#[contractevent] pub struct ClaimSubmitted { #[topic] pub claim_id:u32, pub risk:u32, pub settle_after:u64 }
#[contractevent] pub struct ClaimFrozen { #[topic] pub claim_id:u32, pub funder:Address }
#[contractevent] pub struct MilestoneReleased { #[topic] pub claim_id:u32, pub ngo:Address, pub amount:i128 }
const DAY:u32=17280; const LO:u32=DAY*30; const HI:u32=DAY*60;
fn cfg(e:&Env)->Result<Config,Error>{e.storage().instance().get(&Key::Config).ok_or(Error::NotInit)}
fn stats(e:&Env)->Stats{e.storage().instance().get(&Key::Stats).unwrap_or(Stats{grants:0,escrowed:0,released:0,claims:0,auto_released:0,flagged:0,duplicates_blocked:0,frozen:0})}
fn put<T:soroban_sdk::TryFromVal<Env,soroban_sdk::Val>+soroban_sdk::IntoVal<Env,soroban_sdk::Val>>(e:&Env,k:&Key,v:&T){e.storage().persistent().set(k,v);e.storage().persistent().extend_ttl(k,LO,HI)}
fn put_stats(e:&Env,s:&Stats){e.storage().instance().set(&Key::Stats,s);e.storage().instance().extend_ttl(LO,HI)}
fn next(e:&Env,k:&Key)->u32{let n=e.storage().instance().get::<Key,u32>(k).unwrap_or(0);e.storage().instance().set(k,&(n+1));n}
#[contract] pub struct ChainShield;
#[contractimpl] impl ChainShield {
 pub fn init(e:Env,attestor:Address,risk_threshold:u32,challenge_secs:u64)->Result<(),Error>{if e.storage().instance().has(&Key::Config){return Err(Error::AlreadyInit)}e.storage().instance().set(&Key::Config,&Config{attestor,risk_threshold,challenge_secs});Ok(())}
 pub fn create_grant(e:Env,funder:Address,ngo:Address,token_addr:Address,name:String,milestones:Vec<i128>)->Result<u32,Error>{funder.require_auth();if milestones.is_empty(){return Err(Error::BadParams)}let mut total=0;let mut released=Vec::new(&e);for m in milestones.iter(){if m<=0{return Err(Error::BadParams)}total+=m;released.push_back(false)}token::TokenClient::new(&e,&token_addr).transfer(&funder,&e.current_contract_address(),&total);let id=next(&e,&Key::NextGrant);put(&e,&Key::Grant(id),&Grant{id,name,funder,ngo,token:token_addr,milestones,released,escrowed:total});let mut s=stats(&e);s.grants+=1;s.escrowed+=total;put_stats(&e,&s);Ok(id)}
 pub fn submit_claim(e:Env,grant_id:u32,milestone:u32,doc_hash:BytesN<32>,amount:i128,risk:u32)->Result<u32,Error>{let c=cfg(&e)?;c.attestor.require_auth();let g:Grant=e.storage().persistent().get(&Key::Grant(grant_id)).ok_or(Error::NotFound)?;if g.released.get(milestone).ok_or(Error::NotFound)?{return Err(Error::MilestoneDone)}let id=next(&e,&Key::NextClaim);let mut s=stats(&e);s.claims+=1;if let Some(first)=e.storage().persistent().get::<Key,u32>(&Key::DocSeen(doc_hash.clone())){put(&e,&Key::Claim(id),&Claim{id,grant_id,milestone,doc_hash,amount,risk,status:ClaimStatus::Duplicate,settle_after:0});s.duplicates_blocked+=1;put_stats(&e,&s);DuplicateBlocked{claim_id:id,first_claim_id:first}.publish(&e);return Ok(id)}put(&e,&Key::DocSeen(doc_hash.clone()),&id);let after=if risk>=c.risk_threshold{s.flagged+=1;e.ledger().timestamp()+c.challenge_secs}else{s.auto_released+=1;e.ledger().timestamp()};put(&e,&Key::Claim(id),&Claim{id,grant_id,milestone,doc_hash,amount,risk,status:ClaimStatus::Pending,settle_after:after});put_stats(&e,&s);ClaimSubmitted{claim_id:id,risk,settle_after:after}.publish(&e);Ok(id)}
 pub fn freeze(e:Env,id:u32)->Result<(),Error>{let mut c:Claim=e.storage().persistent().get(&Key::Claim(id)).ok_or(Error::NotFound)?;if c.status!=ClaimStatus::Pending{return Err(Error::NotPending)}let g:Grant=e.storage().persistent().get(&Key::Grant(c.grant_id)).ok_or(Error::NotFound)?;g.funder.require_auth();if e.ledger().timestamp()>=c.settle_after{return Err(Error::WindowClosed)}c.status=ClaimStatus::Frozen;put(&e,&Key::Claim(id),&c);let mut s=stats(&e);s.frozen+=1;put_stats(&e,&s);ClaimFrozen{claim_id:id,funder:g.funder}.publish(&e);Ok(())}
 pub fn settle(e:Env,id:u32)->Result<i128,Error>{let mut c:Claim=e.storage().persistent().get(&Key::Claim(id)).ok_or(Error::NotFound)?;if c.status!=ClaimStatus::Pending{return Err(Error::NotPending)}if e.ledger().timestamp()<c.settle_after{return Err(Error::WindowOpen)}let mut g:Grant=e.storage().persistent().get(&Key::Grant(c.grant_id)).ok_or(Error::NotFound)?;if g.released.get(c.milestone).ok_or(Error::NotFound)?{return Err(Error::MilestoneDone)}let payout=g.milestones.get(c.milestone).ok_or(Error::NotFound)?;token::TokenClient::new(&e,&g.token).transfer(&e.current_contract_address(),&g.ngo,&payout);g.released.set(c.milestone,true);g.escrowed-=payout;put(&e,&Key::Grant(g.id),&g);c.status=ClaimStatus::Settled;put(&e,&Key::Claim(id),&c);let mut s=stats(&e);s.released+=payout;s.escrowed-=payout;put_stats(&e,&s);MilestoneReleased{claim_id:id,ngo:g.ngo,amount:payout}.publish(&e);Ok(payout)}
 pub fn get_grant(e:Env,id:u32)->Result<Grant,Error>{e.storage().persistent().get(&Key::Grant(id)).ok_or(Error::NotFound)} pub fn get_claim(e:Env,id:u32)->Result<Claim,Error>{e.storage().persistent().get(&Key::Claim(id)).ok_or(Error::NotFound)} pub fn seen(e:Env,h:BytesN<32>)->Option<u32>{e.storage().persistent().get(&Key::DocSeen(h))} pub fn get_stats(e:Env)->Stats{stats(&e)} }
