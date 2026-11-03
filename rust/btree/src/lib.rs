#![allow(incomplete_features)]
#![feature(generic_const_exprs)]

pub struct Tree<const FANOUT: usize, const MAX_ELEMENTS: usize>
where
    [(); FANOUT - 1]:,
{
    data: [NodeData<FANOUT>; MAX_ELEMENTS],
}

pub enum NodeData<const FANOUT: usize>
where
    [(); FANOUT - 1]:,
{
    Leaf {
        occupancy: usize,
        data: [usize; FANOUT - 1],
    },
    Internal {
        occupancy: usize,
        data: [usize; FANOUT - 1],
        children: [usize; FANOUT],
    },
}

pub enum InsertMode {
    TopDown,
    BottomUp,
}

impl<const FANOUT: usize, const MAX_ELEMENTS: usize> Tree<FANOUT, MAX_ELEMENTS>
where
    [(); FANOUT - 1]:,
{
    pub fn new(insert_mode: InsertMode) -> Tree<FANOUT, MAX_ELEMENTS> {
        if FANOUT < 3 {
            panic!("")
        }

        if matches!(insert_mode, InsertMode::TopDown) && FANOUT % 2 == 1 {
            panic!("")
        }

        Tree { data: todo!() }
    }
}
